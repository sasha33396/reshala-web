import { Type } from 'class-transformer'
import { IsIP, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'

export class AddServerByPasswordDto {
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_.()-]{0,127}$/)
  name!: string

  @IsIP()
  ip!: string

  @IsString()
  @Matches(/^[^\r\n|]+$/)
  password!: string

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z_][A-Za-z0-9_-]*\$?$/)
  user?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
  port?: number
}
