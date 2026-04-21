import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { KolService } from './kol.service';
import { CreateKolDto } from './dto/create-kol.dto';
import { UpdateKolDto } from './dto/update-kol.dto';
import { StyleLearnDto } from './dto/style-learn.dto';

@Controller('kols')
export class KolController {
  constructor(private readonly kolService: KolService) {}

  @Post()
  create(@Body() dto: CreateKolDto) {
    return this.kolService.create(dto);
  }

  @Get()
  findAll(
    @Query('platform') platform?: string,
    @Query('isActive') isActive?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    return this.kolService.findAll({
      platform,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      q,
      limit: limit ? parseInt(limit) : undefined,
      skip: skip ? parseInt(skip) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.kolService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateKolDto) {
    return this.kolService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.kolService.remove(id);
  }

  @Post(':id/style-learn')
  triggerStyleLearn(@Param('id') id: string, @Body() dto: StyleLearnDto) {
    return this.kolService.enqueueStyleLearn(id, dto.force ?? false);
  }

  @Get(':id/stats')
  getStats(@Param('id') id: string) {
    return this.kolService.getStats(id);
  }

  @Get(':id/posts')
  getPosts(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    // Implemented in Phase 4 — stub
    void limit;
    void skip;
    return { kolId: id, data: [], total: 0 };
  }
}
