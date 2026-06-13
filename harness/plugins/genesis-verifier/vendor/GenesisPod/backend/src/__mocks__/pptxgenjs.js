/**
 * Mock implementation of pptxgenjs for Jest tests.
 * pptxgenjs uses dynamic imports that are incompatible with Jest without
 * --experimental-vm-modules. This mock provides a simple implementation.
 */

function PptxGenJS() {
  this.author = "";
  this.title = "";
  this.subject = "";
  this.company = "";
  this.layout = "LAYOUT_16x9";

  this.defineSlideMaster = jest.fn();

  this.addSlide = jest.fn(() => {
    const slide = {
      addText: jest.fn().mockReturnThis(),
      addShape: jest.fn().mockReturnThis(),
      addTable: jest.fn().mockReturnThis(),
      addImage: jest.fn().mockReturnThis(),
    };
    return slide;
  });

  this.write = jest.fn().mockResolvedValue(Buffer.from("pptx-content"));
}

module.exports = PptxGenJS;
module.exports.default = PptxGenJS;
Object.defineProperty(module.exports, "__esModule", { value: true });
