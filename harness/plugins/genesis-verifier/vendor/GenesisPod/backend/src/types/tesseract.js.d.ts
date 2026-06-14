declare module "tesseract.js" {
  interface RecognizeResult {
    data: {
      text: string;
      confidence: number;
      lines: Array<{
        text: string;
        confidence: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
      words: Array<{
        text: string;
        confidence: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
      imageSize?: {
        width: number;
        height: number;
      };
    };
  }

  interface RecognizeOptions {
    logger?: (message: { status?: string; progress?: number }) => void;
    tessedit_pageseg_mode?: number;
    [key: string]: unknown;
  }

  interface WorkerOptions {
    logger?: (message: unknown) => void;
    errorHandler?: (error: Error) => void;
  }

  interface Worker {
    loadLanguage(lang: string): Promise<void>;
    initialize(lang: string): Promise<void>;
    recognize(image: string | Buffer | ArrayBuffer): Promise<RecognizeResult>;
    terminate(): Promise<void>;
  }

  function createWorker(options?: WorkerOptions): Promise<Worker>;

  function recognize(
    image: string | Buffer | ArrayBuffer,
    language?: string,
    options?: RecognizeOptions,
  ): Promise<RecognizeResult>;

  const Tesseract: {
    createWorker: typeof createWorker;
    recognize: typeof recognize;
  };

  export default Tesseract;
}
