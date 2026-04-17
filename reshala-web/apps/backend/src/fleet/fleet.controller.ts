import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  NotFoundException,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { FleetService } from './fleet.service'
import { CreateServerDto } from './dto/create-server.dto'
import { UpdateServerDto } from './dto/update-server.dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@UseGuards(JwtAuthGuard)
@Controller('fleet')
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  @Get()
  getAll() {
    return this.fleetService.getGrouped()
  }

  @Get(':name')
  getOne(@Param('name') name: string) {
    const server = this.fleetService.getByName(name)
    if (!server) throw new NotFoundException(`Server "${name}" not found`)
    return server
  }

  @Post()
  create(@Body() dto: CreateServerDto) {
    this.fleetService.add(dto)
    return { ok: true }
  }

  @Patch(':name')
  update(@Param('name') name: string, @Body() dto: UpdateServerDto) {
    return this.fleetService.update(name, dto)
  }

  @Delete(':name')
  remove(@Param('name') name: string) {
    this.fleetService.remove(name)
    return { ok: true }
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importFleet(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded')
    const content = file.buffer.toString('utf-8')
    return this.fleetService.importFromText(content)
  }

  @Post(':name/provision')
  async provision(@Param('name') name: string) {
    return this.fleetService.provisionServer(name)
  }

  @Post('provision-all')
  async provisionAll() {
    return this.fleetService.provisionAll()
  }
}
