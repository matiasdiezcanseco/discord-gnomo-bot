import { Injectable } from '@nestjs/common';
import { BaseTool, type ToolResponse } from '../utils/base-tool';
import { BucketService } from '../../services/bucket/bucket.service';
import { LoggerService } from '../../services/logger/logger.service';

/**
 * Tool for fetching random images from S3
 */
@Injectable()
export class ImageTool extends BaseTool {
  name = 'image-tool';

  constructor(
    private readonly bucket: BucketService,
    logger: LoggerService,
  ) {
    super(logger);
  }

  /**
   * Fetch a random image from S3
   */
  protected async run(): Promise<ToolResponse> {
    const image = await this.bucket.getRandomBucketItem<string>('images.json');

    if (!image) {
      return this.createErrorResponse('No hay imágenes disponibles');
    }

    const imageUrl = this.bucket.getBucketUrl(image);
    return this.createSuccessResponse(imageUrl);
  }
}
