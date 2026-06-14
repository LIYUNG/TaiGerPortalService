const async = require('async');
const path = require('path');

const generalMLPrompt = (props) => `
Your first name is ${props.student_info?.firstname} and last name ${
  props.student_info?.lastname
}, a intelligent student. You will write a customed ${
  props.file_type_name
} based on the following information
1. program information
2. document requirements,
3. your background information:  ${JSON.stringify(
  props.student_info
)} (please ignore all placeholder, only use placeholder information if there is no answer) , 
4. your the survey information.
Please write a customized ${props.file_type_name} for this program: ${
  props.program_full_name
}.
The customization needs to be based on the your survey information ${
  props.student_input
}, you should write a great ${
  props.file_type_name
} but please keep the essence of the provided information. 
Reminder: you will create a customized ${
  props.file_type_name
} and strictly follow the program requirement ${
  props.document_requirements
} and additional requirements ${
  props.editor_requirements
} if existed, and write your firstname ${
  props.student_info?.firstname
} and last name ${props.student_info?.lastname} in the end of the text`;

module.exports = {
  generalMLPrompt
};
