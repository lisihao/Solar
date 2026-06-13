declare module "youtubei.js" {
  export class Innertube {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party module type stub; real types not available
    static create(config?: any): Promise<Innertube>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party module type stub; real types not available
    getInfo(videoId: string): Promise<any>;
  }

  export namespace Log {
    const Level: {
      NONE: number;
      ERROR: number;
      WARNING: number;
      INFO: number;
      DEBUG: number;
    };
    function setLevel(...args: number[]): void;
  }
}
