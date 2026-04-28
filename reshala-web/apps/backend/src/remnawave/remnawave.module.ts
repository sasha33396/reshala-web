import { Module } from '@nestjs/common'
import { RemnawaveService } from './remnawave.service'
import { RemnawaveController } from './remnawave.controller'

@Module({
  providers: [RemnawaveService],
  controllers: [RemnawaveController],
  exports: [RemnawaveService],
})
export class RemnawaveModule {}
