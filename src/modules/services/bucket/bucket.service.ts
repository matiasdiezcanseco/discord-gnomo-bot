import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger/logger.service';

@Injectable()
export class BucketService {
  private readonly axiosInstance: AxiosInstance;
  private readonly logger;

  constructor(
    private readonly config: ConfigService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.createLogger('bucket');
    const bucketUrl = this.config.get<string>('BUCKET_URL');

    this.axiosInstance = axios.create({
      baseURL: bucketUrl,
      timeout: 10000,
    });

    // Add request interceptor for logging
    this.axiosInstance.interceptors.request.use(
      (config) => {
        this.logger.debug({ url: config.url }, 'Fetching bucket data');
        return config;
      },
      (error) => {
        this.logger.error({ err: error }, 'Bucket request error');
        return Promise.reject(error);
      },
    );

    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        this.logger.error(
          { err: error, url: error.config?.url },
          'Bucket response error',
        );
        return Promise.reject(error);
      },
    );
  }

  /**
   * Ping the bucket service to check availability
   */
  async ping(): Promise<void> {
    await this.axiosInstance.get('/', { timeout: 5000 });
  }

  /**
   * Fetch data from the bucket URL
   * @param path The path to the JSON file (e.g., 'phrases.json')
   * @returns The parsed data or null on error
   */
  async fetchBucketData<T>(path: string): Promise<T | null> {
    try {
      const { data } = await this.axiosInstance.get<T>(path);
      return data;
    } catch (error) {
      this.logger.error({ err: error, path }, 'Failed to fetch bucket data');
      return null;
    }
  }

  /**
   * Get a random item from a bucket array
   * @param path The path to the JSON file containing an array
   * @returns A random item from the array or null on error
   */
  async getRandomBucketItem<T>(path: string): Promise<T | null> {
    const items = await this.fetchBucketData<T[]>(path);
    if (!items || items.length === 0) {
      return null;
    }
    return items[Math.floor(Math.random() * items.length)];
  }

  /**
   * Get the full bucket URL for a resource
   * @param path The relative path to the resource
   * @returns The full URL
   */
  getBucketUrl(path: string): string {
    const bucketUrl = this.config.get<string>('BUCKET_URL');
    return bucketUrl + path;
  }
}
