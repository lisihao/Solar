export interface ISeeder {
  readonly name: string;
  sync(): Promise<SeederResult>;
}

export interface SeederResult {
  created: number;
  updated: number;
  skipped: number;
}
