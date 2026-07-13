import { IsIP, IsString, IsNumber, IsOptional, Matches, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class UpdateServerDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z_][A-Za-z0-9_-]*\$?$/)
  user?: string

  @IsOptional()
  @IsIP()
  ip?: string

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
  port?: number

  @IsOptional()
  @IsString()
  @Matches(/^[^\r\n|]+$/)
  keyPath?: string

  @IsOptional()
  @IsString()
  @Matches(/^[^\r\n|]*$/)
  sudoPass?: string
}
