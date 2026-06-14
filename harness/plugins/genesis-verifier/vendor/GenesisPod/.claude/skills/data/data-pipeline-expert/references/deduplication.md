# Deduplication Strategies

## 1. URL Normalization

```typescript
normalizeUrl(url: string): string {
  const parsed = new URL(url);
  // Remove tracking parameters
  const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'ref'];
  trackingParams.forEach(param => parsed.searchParams.delete(param));
  // Normalize protocol and trailing slashes
  return parsed.toString().replace(/\/$/, '').toLowerCase();
}
```

## 2. Content Fingerprinting

```typescript
generateFingerprint(content: string): string {
  // Remove whitespace and normalize
  const normalized = content
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  // Generate hash
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
```

## 3. Similarity Detection

```typescript
async checkSimilarity(newContent: string, threshold = 0.85): Promise<boolean> {
  const fingerprint = this.generateFingerprint(newContent);
  const existing = await this.findByFingerprint(fingerprint);

  if (existing) return true;

  // Check fuzzy similarity for near-duplicates
  const similar = await this.findSimilarContent(newContent, threshold);
  return similar.length > 0;
}
```

## 4. Pre-Insert Check

```typescript
async createIfNotExists(data: RawDataInput): Promise<RawDataRecord | null> {
  const fingerprint = this.generateFingerprint(data.content);
  const normalizedUrl = this.normalizeUrl(data.originalUrl);

  // Check both URL and content fingerprint
  const existing = await this.rawDataModel.findOne({
    $or: [
      { normalizedUrl },
      { fingerprint }
    ]
  });

  if (existing) {
    this.logger.debug(`Duplicate detected: ${data.originalUrl}`);
    return null;
  }

  return this.rawDataModel.create({
    ...data,
    normalizedUrl,
    fingerprint,
  });
}
```

## Unified Deduplication Service

```typescript
@Injectable()
export class UnifiedDeduplicationService {
  async filter(items: RawDataInput[]): Promise<RawDataInput[]> {
    const unique: RawDataInput[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const fingerprint = this.generateFingerprint(item.content);
      const normalizedUrl = this.normalizeUrl(item.originalUrl);
      const key = `${normalizedUrl}:${fingerprint}`;

      if (seen.has(key)) continue;

      const existsInDb = await this.checkExists(normalizedUrl, fingerprint);
      if (existsInDb) continue;

      seen.add(key);
      unique.push(item);
    }

    return unique;
  }
}
```
