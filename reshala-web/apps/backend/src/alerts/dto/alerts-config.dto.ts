import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsString, Max, Min, ValidateNested } from 'class-validator'

export class AlertThresholdsDto {
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  cpuPercent!: number

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  ramPercent!: number

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  diskPercent!: number

  @IsBoolean()
  offlineCheck!: boolean
}

export class AlertsConfigDto {
  @IsBoolean()
  enabled!: boolean

  @IsString()
  telegramBotToken!: string

  @IsString()
  telegramChatId!: string

  @IsInt()
  @Min(1)
  @Max(1440)
  @Type(() => Number)
  checkIntervalMinutes!: number

  @IsInt()
  @Min(1)
  @Max(10080)
  @Type(() => Number)
  cooldownMinutes!: number

  @ValidateNested()
  @Type(() => AlertThresholdsDto)
  thresholds!: AlertThresholdsDto
}
