import { IsOptional, IsBoolean } from 'class-validator';

export class StyleLearnDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
