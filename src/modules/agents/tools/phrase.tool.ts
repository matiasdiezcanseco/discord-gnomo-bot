import { Injectable } from '@nestjs/common';
import { BaseTool, type ToolResponse } from '../utils/base-tool';
import { BucketService } from '../../services/bucket/bucket.service';
import { LoggerService } from '../../services/logger/logger.service';

/**
 * Tool for fetching random phrases/quotes from S3
 */
@Injectable()
export class PhraseTool extends BaseTool {
  name = 'phrase-tool';

  constructor(
    private readonly bucket: BucketService,
    logger: LoggerService,
  ) {
    super(logger);
  }

  /**
   * Fetch a random phrase from S3
   */
  protected async run(): Promise<ToolResponse> {
    const phrase = await this.bucket.getRandomBucketItem<string>('phrases.json');

    if (!phrase) {
      return this.createErrorResponse('No hay frases disponibles');
    }

    return this.createSuccessResponse(phrase);
  }
}
