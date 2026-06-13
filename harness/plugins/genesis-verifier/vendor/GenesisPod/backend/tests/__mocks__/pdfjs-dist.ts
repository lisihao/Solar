/**
 * Mock for pdfjs-dist for E2E tests
 */

export const getDocument = jest.fn().mockReturnValue({
  promise: Promise.resolve({
    numPages: 1,
    getPage: jest.fn().mockResolvedValue({
      getTextContent: jest.fn().mockResolvedValue({
        items: [{ str: "Mock PDF content" }],
      }),
    }),
  }),
});

export const GlobalWorkerOptions = {
  workerSrc: "",
};

export default {
  getDocument,
  GlobalWorkerOptions,
};
