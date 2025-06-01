export interface ProcessingState {
  isProcessing: boolean;
  current: number;
  total: number;
}

export interface CustomJwtPayload {
  operatorId: string;
  email: string;
  alphaDateToken: string;
  profiles?: string[];
  iat?: number;
  exp?: number;
}

export const processingStates = new Map<string, ProcessingState>(); 