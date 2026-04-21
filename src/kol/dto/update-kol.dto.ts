import { PartialType } from '@nestjs/mapped-types';
import { CreateKolDto } from './create-kol.dto';

export class UpdateKolDto extends PartialType(CreateKolDto) {}
