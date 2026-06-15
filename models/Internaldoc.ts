import { internaldocsSchema } from '@taiger-common/model';

internaldocsSchema.index({ title: 'text', text: 'text' });

export = { internaldocsSchema };
