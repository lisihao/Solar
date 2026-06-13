// Core stores
export * from './core';

// AI Office stores - export everything to maintain compatibility
export * from './ai-office';

// AI Teams stores (existing modular structure)
export * from './ai-teams';

// AI Writing stores
export * from './ai-writing';

// AI Social stores
export * from './ai-social';

// AI Image stores
export * from './ai-image';

// User stores
export * from './user';

// Legacy: aiOfficeStore (large file, kept at root for now)
// Note: Only export items that don't conflict with modular versions
export * from './aiOfficeStore';

// Legacy stores - only export unique items not in modular versions
// aiTeamsStore is fully replaced by ai-teams module
// export * from './aiTeamsStore';
