# Retrieval-Augmented Generation in Practice

Retrieval-Augmented Generation (RAG) pairs a generative language model with an external retrieval system so answers can be grounded in source documents the model never memorized. The pattern emerged from the 2020 paper by Lewis et al. and is the dominant industrial recipe for question answering over private corpora, support, and any domain where knowledge changes faster than a model can be retrained. This document outlines the major building blocks and the evaluation discipline required to ship RAG into production.

## Indexing pipeline

### Chunking

Chunking is the process of slicing source documents into retrieval units, typically a few hundred tokens long. The naive baseline is fixed-size character chunks with overlap, but production systems usually adopt a structural splitter that respects markdown headings or paragraph boundaries. Poor chunking is the single largest source of bad retrieval results — chunks that span topic boundaries inject noise, while chunks that are too short fragment reasoning. A common refinement is hierarchical chunking, storing small leaf chunks for precise lookup and larger parent passages substituted at generation time.

### Embedding

Embedding is the projection of text chunks into dense vectors that capture semantic similarity. Modern embedding models such as OpenAI text-embedding-3-large, Cohere Embed v3, BGE-M3, and Voyage 3 differ in dimensionality, multilingual support, and latency. Embedding dimension trades index size against retrieval quality — 1024 to 1536 dimensions is a common sweet spot. Critical details include normalizing vectors before cosine similarity, batching aggressively, and pinning one embedding model per index because mixing versions silently destroys recall.

### Vector Database

A Vector Database stores embeddings alongside their source chunks and supports approximate nearest neighbor (ANN) search at scale. Industry options include Pinecone, Weaviate, Qdrant, Milvus, and pgvector for teams that keep retrieval inside PostgreSQL. The two dominant ANN algorithms are HNSW and IVF-PQ, each with a recall-vs-latency knob. Production indexes also need metadata filtering for tenant isolation and access controls.

## Retrieval layer

### Dense Retrieval

Dense Retrieval uses embedding similarity for top-k search. It excels at paraphrases and semantic similarity but fails on rare proper nouns, exact identifiers, or numeric queries where lexical overlap matters more than meaning. Dense retrievers also exhibit "domain shift" — an embedding model trained on web text underperforms on legal or biomedical corpora unless fine-tuned.

### BM25

BM25 is a classical lexical retrieval algorithm based on term frequency and inverse document frequency, maintained inside engines like Elasticsearch and OpenSearch. It handles exact-match queries, identifiers, and out-of-vocabulary words much better than dense embeddings. Treating BM25 as strictly worse is a costly mistake — on many workloads it outperforms a generic embedding model.

### Hybrid Search

Hybrid Search combines dense retrieval and BM25 by taking the union of their top-k results or fusing scores through reciprocal rank fusion (RRF). It is the default in mature RAG systems because it inherits both strengths: semantic recall from dense vectors plus exact-match precision from lexical. The recall lift is typically five to fifteen points.

## Generation layer

### Reranker

A Reranker is a cross-encoder model that scores each (query, candidate) pair jointly, producing a more accurate relevance signal than the bi-encoder used for first-stage retrieval. Common rerankers include Cohere Rerank, BGE Reranker, and Jina Reranker. They are applied to the top 50 to 100 results and reduce them to the top 5 to 10 fed into the prompt. Because cross-encoders are slower than bi-encoders, batching matters.

### Context Assembly

Once the final set of chunks is selected, they are assembled into the LLM prompt along with the user query and system instructions. Critical decisions include de-duplicating overlapping chunks, ordering by relevance, citing originating document IDs so the model can attribute answers, and reserving token budget for reasoning. The "lost in the middle" phenomenon means placing the most important chunks at the beginning and end of the context window improves answer quality.

## Evaluation

Evaluating a RAG system requires decoupling retrieval quality from generation quality. Retrieval is scored with recall@k, precision@k, and nDCG against labeled (query, relevant-chunk) pairs. Generation is scored with faithfulness — does every claim trace back to a retrieved chunk — and answer relevance. Frameworks such as RAGAS, TruLens, and Ares automate these using LLM-as-judge. Teams also track end-to-end metrics like thumbs-up rate and escalation rate.

## Common failure modes

The most common failure is the retriever returning chunks that look relevant but do not contain the answer, manifesting as confident hallucinations. The cure is usually better chunking and a reranker, not a bigger model. Other recurring failures include stale indexes, embedding drift after silent model upgrades, prompt injection through poisoned documents, and access-control leaks when filtering is bolted on after indexing. Mature deployments include retrieval observability — sampled trace logging of (query, retrieved chunks, final answer) tuples — so failures can be diagnosed after the fact.
