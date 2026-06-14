# Evidence Service Tests

This directory contains comprehensive unit tests for the Evidence Manager Service.

## Test Files

- `evidence-manager.service.spec.ts` - Main test suite (33 tests)
- `TEST_REPORT.md` - Detailed test coverage report

## Quick Start

### Run All Tests

```bash
cd backend
npm test -- evidence-manager.service.spec.ts
```

### Run Specific Test Suite

```bash
# Test only save() methods
npm test -- evidence-manager.service.spec.ts -t "save"

# Test only saveBatch() methods
npm test -- evidence-manager.service.spec.ts -t "saveBatch"

# Test only retrieve() methods
npm test -- evidence-manager.service.spec.ts -t "retrieve"
```

### Run in Watch Mode

```bash
npm test -- evidence-manager.service.spec.ts --watch
```

### Run with Verbose Output

```bash
npm test -- evidence-manager.service.spec.ts --verbose
```

## Test Structure

```
EvidenceManagerService
├── save() - 4 tests
│   ├── Normal flow
│   ├── Default values
│   ├── Edge cases
│   └── Error handling
├── saveBatch() - 6 tests
│   ├── Normal flow (< 100 items)
│   ├── Batch boundaries (100, 250 items)
│   ├── Empty batch
│   └── Error handling
├── retrieve() - 6 tests
│   ├── Filtering & sorting
│   ├── Default values
│   └── Pagination
├── getStats() - 5 tests
│   ├── Statistics calculation
│   ├── Null handling
│   └── Edge cases
└── ... (11 test suites total)
```

## Coverage

- **Total Tests**: 33
- **Test Suites**: 11
- **Coverage**: 100% of all public methods

## Key Test Scenarios

### 1. Batch Processing

- Tests batch splitting (100 items per batch)
- Tests transaction timeout (30 seconds)
- Tests error handling and rollback

### 2. Null Handling

- Verifies null values converted to undefined
- Tests optional field handling
- Tests credibilityScore averaging (excludes nulls)

### 3. Default Values

- relevanceScore defaults to 0.5
- limit defaults to 50
- offset defaults to 0
- sort defaults to createdAt desc

### 4. Error Scenarios

- Database operation failures
- Batch processing errors
- Missing data validation

## Mocking Strategy

All external dependencies are mocked:

```typescript
// PrismaService mock
const mockPrismaService = {
  evidence: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn(),
};

// CitationFormatterService mock
const mockCitationFormatterService = {
  format: jest.fn(),
  formatBibliography: jest.fn(),
};
```

## Business Rules Tested

| Rule                                 | Verified |
| ------------------------------------ | -------- |
| Default relevanceScore = 0.5         | ✅       |
| Batch size = 100 items               | ✅       |
| Transaction timeout = 30s            | ✅       |
| Stop on batch error                  | ✅       |
| Exclude null from avg                | ✅       |
| CITATION + REFERENCE in bibliography | ✅       |

## Adding New Tests

When adding new methods to `EvidenceManagerService`, follow this pattern:

```typescript
describe("newMethod", () => {
  it("should handle normal flow", async () => {
    // Arrange
    const input = createMockInput();
    mockService.method.mockResolvedValue(mockOutput);

    // Act
    const result = await service.newMethod(input);

    // Assert
    expect(result).toBeDefined();
    expect(mockService.method).toHaveBeenCalledWith(
      expect.objectContaining({ ... })
    );
  });

  it("should handle edge cases", async () => {
    // Test null/undefined/empty inputs
  });

  it("should handle errors", async () => {
    // Test error scenarios
    mockService.method.mockRejectedValue(new Error("Test error"));
    await expect(service.newMethod(input)).rejects.toThrow();
  });
});
```

## Debugging Failed Tests

### View Test Output

```bash
npm test -- evidence-manager.service.spec.ts --verbose
```

### Run Single Test

```bash
npm test -- evidence-manager.service.spec.ts -t "should create and return"
```

### Check Mock Calls

```typescript
// In test
console.log(prisma.evidence.create.mock.calls);
```

## Related Documentation

- [Test Report](./TEST_REPORT.md) - Detailed coverage report
- [Evidence Interface](../../abstractions/evidence.interface.ts) - Type definitions
- [Service Source](../evidence-manager.service.ts) - Implementation

## Notes

- The error log "Batch 100-150 failed" is expected - it's from a test that verifies error handling
- All tests use mocked dependencies - no real database calls
- Tests follow AAA pattern (Arrange, Act, Assert)

---

**Last Updated**: 2026-02-04
**Status**: ✅ All 33 tests passing
