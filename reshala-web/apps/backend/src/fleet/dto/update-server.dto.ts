import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class UpdateServerDto {
  @IsOptional()
  @IsString()
  user?: string

  @IsOptional()
  @IsString()
  ip?: string

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
  port?: number

  @IsOptional()
  @IsString()
  keyPath?: string

  @IsOptional()
  @IsString()
  sudoPass?: string
}
