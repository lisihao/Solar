/**
 * Custom hook for extracting text from PDF files
 */

import { useState, useEffect } from 'react';
import { config } from '@/lib/utils/config';
import type { Resource } from '../utils/types';

import { logger } from '@/lib/utils/logger';
export function usePDFText(selectedResource: Resource | null) {
  const [pdfText, setPdfText] = useState<string>('');

  useEffect(() => {
    const extractPdfText = async () => {
      if (!selectedResource || !selectedResource.pdfUrl) {
        setPdfText('');
        return;
      }

      try {
        // Dynamically import PDF.js only on client side
        const pdfjsLib = await import('pdfjs-dist');

        // Configure worker - use unpkg which has latest versions
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

        const pdfUrl = `${config.apiUrl}/proxy/pdf?url=${encodeURIComponent(selectedResource.pdfUrl)}`;

        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;

        let fullText = '';
        const maxPages = Math.min(pdf.numPages, 20); // Limit to first 20 pages

        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item) => (item as { str: string }).str)
            .join(' ');
          fullText += pageText + '\n';

          // Break if we have enough text (>15000 chars is enough for AI context)
          if (fullText.length > 15000) {
            break;
          }
        }

        setPdfText(fullText.substring(0, 15000));
        logger.debug('PDF text extracted:', { length: fullText.length });
      } catch (error) {
        logger.error('Failed to extract PDF text:', error);
        setPdfText('');
      }
    };

    extractPdfText();
  }, [selectedResource]);

  return pdfText;
}
