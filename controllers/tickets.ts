import { is_TaiGer_role } from '@taiger-common/core';
import { asyncHandler } from '../middlewares/error-handler';
import { isNotArchiv } from '../constants';
import {
  TicketCreatedAgentEmail,
  TicketResolvedRequesterReminderEmail
} from '../services/email';
import ProgramService from '../services/programs';
import StudentService from '../services/students';
import TicketService from '../services/tickets';

const getTickets = asyncHandler(async (req, res) => {
  const { user } = req;

  const { type, program_id, status } = req.query;
  const query = {};
  if (type) {
    query.type = type;
  }
  if (program_id) {
    query.program_id = program_id;
  }
  if (status) {
    query.status = status;
  }
  const tickets = await TicketService.getTickets(query, {
    populateRequester: is_TaiGer_role(user)
  });
  res.send({ success: true, data: tickets });
});

const getTicketsOverview = asyncHandler(async (req, res) => {
  const { tickets, total, page, limit } =
    await TicketService.getTicketsOverview(req.query);
  res.send({ success: true, data: tickets, total, page, limit });
});

const createTicket = asyncHandler(async (req, res) => {
  const { user } = req;
  const new_ticket = req.body;
  new_ticket.requester_id = user._id.toString();
  // TODO: DO not create the same
  const ticket = await TicketService.createTicket(new_ticket);

  res.status(201).send({ success: true, data: ticket });

  const programPromise = ProgramService.getProgramById(new_ticket.program_id);
  const studentPromise = StudentService.getStudentById(user._id.toString());

  const [program, student] = await Promise.all([
    programPromise,
    studentPromise
  ]);

  for (let i = 0; i < student.agents.length; i += 1) {
    if (isNotArchiv(student)) {
      TicketCreatedAgentEmail(
        {
          firstname: student.agents[i].firstname,
          lastname: student.agents[i].lastname,
          address: student.agents[i].email
        },
        {
          program,
          student
        }
      );
    }
  }
});

const updateTicket = asyncHandler(async (req, res) => {
  const { user } = req;
  const { ticket_id } = req.params;
  const fields = req.body;

  fields.updatedAt = new Date();
  // TODO: update resolver_id
  const updatedTicket = await TicketService.updateTicketById(ticket_id, fields);

  res.status(200).send({ success: true, data: updatedTicket });

  // TODO: to avoid resolved many times
  if (fields?.status === 'resolved') {
    if (isNotArchiv(updatedTicket.requester_id)) {
      TicketResolvedRequesterReminderEmail(
        {
          firstname: updatedTicket.requester_id.firstname,
          lastname: updatedTicket.requester_id.lastname,
          address: updatedTicket.requester_id.email
        },
        {
          program: updatedTicket.program_id,
          student: updatedTicket.requester_id,
          taigerUser: user
        }
      );
    }
  }
});

const deleteTicket = asyncHandler(async (req, res) => {
  await TicketService.deleteTicketById(req.params.ticket_id);
  res.status(200).send({ success: true });
});

export = {
  getTickets,
  getTicketsOverview,
  createTicket,
  updateTicket,
  deleteTicket
};
