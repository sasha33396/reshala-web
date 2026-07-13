import { IsIP, IsString, IsNumber, IsOptional, Matches, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateServerDto {
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_.()-]{0,127}$/)
  name!: string

  @IsString()
  @Matches(/^[A-Za-z_][A-Za-z0-9_-]*\$?$/)
  user!: string

  @IsIP()
  ip!: string

  @IsNumber()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
  port!: number

  @IsString()
  @Matches(/^[^\r\n|]+$/)
  keyPath!: string

  @IsOptional()
  @IsString()
  @Matches(/^[^\r\n|]*$/)
  sudoPass?: string
}
