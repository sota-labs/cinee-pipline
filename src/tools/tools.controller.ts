import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ToolsService } from './tools.service';

@Controller('tools')
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  // KOL callbacks
  @Post('kol/:id/style-learn/result')
  ingestStyleLearnResult(@Param('id') id: string, @Body() body: unknown) {
    return this.toolsService.ingestStyleLearnResult(id, body);
  }

  @Get('kol/crawl-targets')
  getCrawlTargets(
    @Query('limit') limit = '10',
    @Query('offset') offset = '0',
  ) {
    return this.toolsService.getCrawlTargets(parseInt(limit), parseInt(offset));
  }

  @Post('kol/:id/posts/ingest')
  ingestCrawledPosts(@Param('id') id: string, @Body() body: unknown) {
    return this.toolsService.ingestCrawledPosts(id, body);
  }

  @Post('kol/posts/:id/processing/result')
  ingestProcessingResult(@Param('id') id: string, @Body() body: unknown) {
    return this.toolsService.ingestProcessingResult(id, body);
  }

  @Post('kol/comments/:id/posted')
  ingestCommentPosted(@Param('id') id: string, @Body() body: unknown) {
    return this.toolsService.ingestCommentPosted(id, body);
  }

  @Post('kol/comments/:id/visibility-result')
  ingestVisibilityResult(@Param('id') id: string, @Body() body: unknown) {
    return this.toolsService.ingestVisibilityResult(id, body);
  }
}
