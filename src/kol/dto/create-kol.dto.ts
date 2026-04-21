import { IsString, IsOptional, IsBoolean, IsInt, IsUrl, Min, IsIn } from 'class-validator';

export class CreateKolDto {
  @IsString()
  handle: string;

  @IsOptional()
  @IsIn(['x', 'threads'])
  platform?: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsUrl()
  profileUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  followersCount?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
