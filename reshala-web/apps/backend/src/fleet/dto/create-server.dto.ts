import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateServerDto {
  @IsString()
  name!: string

  @IsString()
  user!: string

  @IsString()
  ip!: string

  @IsNumber()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
  port!: number

  @IsString()
  keyPath!: string

  @IsOptional()
  @IsString()
  sudoPass?: string
}
