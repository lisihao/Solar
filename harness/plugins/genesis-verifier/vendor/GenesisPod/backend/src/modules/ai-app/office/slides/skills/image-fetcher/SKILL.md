---
name: image-fetcher
description: 根据关键词搜索并获取相关图片
version: 4.0.0
domain: office
layer: content
tags: [slides, image, fetch, search]
taskTypes: [slides-generation]
priority: 3
author: genesis-ai
source: local

execution-mode: provider
---

# Image Fetcher

> This skill is implemented as a NestJS Provider (code-based tool).
> This SKILL.md provides metadata only — execution is handled by the corresponding .skill.ts file.

Image fetching skill that searches for and retrieves high-quality images based on keywords. Supports Unsplash API (free 50 requests/hour) with automatic fallback to local image library when API is unavailable.

## Key Features

- Searches Unsplash for relevant images based on keywords
- Automatically extracts keywords from titles and content
- Falls back to categorized local image library when API is unavailable
- Supports multiple image sizes (small, medium, large)
- Provides orientation options (landscape, portrait, squarish)

## Image Categories

Includes fallback images for: business, technology, data, team, growth, innovation, weather, city, shopping, lifestyle, network, and nature.

## Input Requirements

- `keywords`: Array of search keywords
- `size` (optional): Image size - small (400), medium (800), or large (1600)
- `orientation` (optional): Image orientation - landscape, portrait, or squarish
- `count` (optional): Number of images to return

## Output Structure

Array of image results, each containing:

- `id`: Unique image identifier
- `url`: Image URL with specified size
- `thumbnailUrl`: Thumbnail URL
- `width` and `height`: Image dimensions
- `description`: Image description (if available)
- `author` and `authorUrl`: Attribution information (if available)
