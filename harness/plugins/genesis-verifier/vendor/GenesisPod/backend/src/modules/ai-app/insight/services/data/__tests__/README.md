# Research Evidence Data Services - Test Suite

Comprehensive unit tests for the research evidence management services.

## Test Files

### 1. research-evidence.adapter.spec.ts (40 tests)

Tests for `ResearchEvidenceAdapter` service - handles dual-write strategy for research evidence.

#### Test Coverage

**Core Functionality:**

- `saveResearchEvidence()` - Dual write to TopicEvidence + Engine Evidence
  - Successful dual-write to both databases
  - Citation index auto-increment
  - Null analysisId handling
  - Graceful degradation when Engine Evidence fails
  - Non-Error exception handling
  - CredibilityScore conversion (0-100 to 0-1)
  - Snippet truncation to 500 chars

**Batch Operations:**

- `saveResearchEvidenceBatch()` - Transaction-based batch processing
  - Empty input handling
  - Transaction atomicity
  - Engine Evidence failure degradation in batch
  - Grouping by reportId
  - Batch size chunking (50 items per batch)

**Type Mapping:**

- `mapSourceTypeToEvidenceType()` - Source type to evidence type conversion
  - Academic/Journal/Paper → CITATION
  - News/Report/Official/Government → REFERENCE
  - Quote → QUOTE
  - Inspiration/Idea → INSPIRATION
  - Web/Blog/Unknown → FACT
  - Case-insensitive mapping

**URL Normalization:**

- `normalizeUrl()` - URL standardization with fallback
  - GlobalDeduplicationService integration
  - Fallback to local normalization
  - Invalid URL handling
  - Duplicate detection
  - Non-duplicate URL check

**Citation Formatting:**

- `formatCitation()` - Single citation formatting
- `generateBibliography()` - Complete reference list
- `generateNumberedBibliography()` - Numbered reference list

**Evidence Retrieval:**

- `getEvidenceStats()` - Statistics aggregation
- `getHighCredibilityEvidence()` - Credibility-based filtering
- `getEvidenceBySourceType()` - Source type filtering

---

### 2. evidence-sync-compensation.service.spec.ts (30 tests)

Tests for `EvidenceSyncCompensationService` - handles retry logic for failed Engine Evidence writes.

#### Test Coverage

**Queue Management:**

- `queueForRetry()` - Add failed writes to retry queue
  - Entry addition to pending queue
  - Unique ID generation
  - Queue capacity limit (1000 entries)
  - Oldest entry eviction on overflow
  - Timestamp tracking

**Retry Logic:**

- `processRetryQueue()` - Process pending retries
  - Empty queue handling
  - Successful retry and removal
  - Retry count increment on failure
  - Permanent failure after max retries (3)
  - Batch processing of multiple entries
  - Mixed success/failure handling
  - Non-Error exception handling
  - lastRetryAt timestamp updates

**Statistics:**

- `getStats()` - Compensation statistics
  - Initial stats (all zeros)
  - Pending count tracking
  - Success count tracking
  - Failed count tracking
  - Permanently failed count tracking
  - Cumulative statistics

**Queue Inspection:**

- `getPendingEntries()` - Get pending queue items
- `getPermanentlyFailedEntries()` - Get permanent failures

**Manual Operations:**

- `triggerRetry()` - Manual retry trigger
- `clearPermanentlyFailed()` - Clear permanent failures
  - Clear all permanently failed entries
  - Does not affect pending entries

**Lifecycle:**

- `onModuleDestroy()` - Cleanup on module destruction
  - Interval clearance
  - Multiple destroy calls handling

**Integration Scenarios:**

- Retry success after temporary network issues
- Permanent failure after max retries exhausted
- Queue capacity overflow management

---

## Running Tests

### Run All Tests

```bash
cd backend
npm test -- "__tests__"
```

### Run Specific Test Suite

```bash
# ResearchEvidenceAdapter tests
npm test -- research-evidence.adapter.spec.ts

# EvidenceSyncCompensationService tests
npm test -- evidence-sync-compensation.service.spec.ts
```

### Run Both Test Suites

```bash
npm test -- "research-evidence.adapter.spec.ts|evidence-sync-compensation.service.spec.ts"
```

### Watch Mode

```bash
npm run test:watch -- research-evidence.adapter.spec.ts
```

---

## Test Results Summary

```
Test Suites: 2 passed, 2 total
Tests:       70 passed, 70 total
Snapshots:   0 total
Time:        ~1.1s
```

### Coverage by Module

| Module                          | Tests | Key Features Tested                            |
| ------------------------------- | ----- | ---------------------------------------------- |
| ResearchEvidenceAdapter         | 40    | Dual-write, batch ops, type mapping, URL dedup |
| EvidenceSyncCompensationService | 30    | Retry logic, queue management, statistics      |

---

## Test Patterns

### 1. Arrange-Act-Assert (AAA)

All tests follow the AAA pattern for clarity:

```typescript
it('should do something', async () => {
  // Arrange
  const mockData = { ... };
  service.mock.mockResolvedValue(mockData);

  // Act
  const result = await adapter.method();

  // Assert
  expect(result).toEqual(expected);
});
```

### 2. Mocking Strategy

- All external dependencies are mocked (PrismaService, EvidenceManagerService, etc.)
- Jest mocks are used consistently
- Mock implementations are cleared between tests

### 3. Error Handling Tests

- Success paths
- Failure paths
- Graceful degradation
- Non-Error exceptions

### 4. Integration Scenarios

- Real-world use cases
- Multiple operations chained
- State verification across operations

---

## Key Testing Principles Applied

1. **Isolation**: Each test is independent, no shared state
2. **Completeness**: Both success and failure paths tested
3. **Clarity**: Descriptive test names and clear AAA structure
4. **Coverage**: Critical paths, edge cases, and error scenarios
5. **Fast**: All tests complete in ~1 second total
6. **Reliable**: No flaky tests, deterministic outcomes

---

## Future Test Enhancements

- [ ] Add performance benchmarks for batch operations
- [ ] Add stress tests for queue overflow scenarios
- [ ] Add integration tests with real Prisma database (test DB)
- [ ] Add E2E tests for complete evidence lifecycle
- [ ] Add coverage for concurrent operation scenarios

---

**Last Updated**: 2026-02-04
**Test Coverage**: 70 tests passing
**Maintainer**: Tester Agent
