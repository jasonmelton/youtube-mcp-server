// Comprehensive type declarations

// Global Utility Types
type Nullable<T> = T | null | undefined;

// Google Services
declare namespace google {
  namespace cloud {
    class LanguageServiceClient {
      analyze(request: any): Promise<any>;
      analyzeSentiment(request: any): Promise<any>;
      analyzeEntities(request: any): Promise<any>;
      classifyText(request: any): Promise<any>;
      summarize(request: any): Promise<any>;
    }

    class SpeechClient {
      longRunningRecognize(request: any): Promise<any>;
    }

    class TranslateClient {
      translate(text: string, target: string): Promise<any>;
    }

    namespace language {
      interface Entity {
        name: string;
        type: string;
        salience: number;
      }

      interface Sentiment {
        score: number;
        magnitude: number;
      }
    }
  }

  namespace youtube {
    function youtube(config: any): any;
  }
}

// Extend fs/promises
declare module 'fs/promises' {
  export function createReadStream(path: string): NodeJS.ReadableStream;
}