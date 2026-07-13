import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, Matches, ValidateNested } from 'class-validator'

export class BulkDockerScanDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250)
  @IsString({ each: true })
  serverNames!: string[]
}

export class BulkDockerTargetDto {
  @IsString()
  serverName!: string

  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/)
  containerId!: string
}

export class BulkDockerControlDto {
  @IsIn(['start', 'stop', 'restart'])
  action!: 'start' | 'stop' | 'restart'

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => BulkDockerTargetDto)
  targets!: BulkDockerTargetDto[]
}
