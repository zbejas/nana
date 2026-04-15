/// <reference path="../../pb_data/types.d.ts" />

// Hook to calculate word_count and reading_time on document create
onModelCreate((e) => {
  // Helper to count words in text
  const countWords = (text) => {
    if (!text || text.trim().length === 0) return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  };

  // Helper to calculate reading time (average 200 words per minute)
  const calculateReadingTime = (wordCount) => {
    return Math.ceil(wordCount / 200);
  };

  const content = e.model.get("content") || "";
  const wordCount = countWords(content);
  const readingTime = calculateReadingTime(wordCount);
  
  e.model.set("word_count", wordCount);
  e.model.set("reading_time", readingTime);
  
  return e.next();
}, "documents");

// Hook to calculate word_count and reading_time on document update
onModelUpdate((e) => {
  // Helper to count words in text
  const countWords = (text) => {
    if (!text || text.trim().length === 0) return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  };

  // Helper to calculate reading time (average 200 words per minute)
  const calculateReadingTime = (wordCount) => {
    return Math.ceil(wordCount / 200);
  };

  const content = e.model.get("content") || "";
  const wordCount = countWords(content);
  const readingTime = calculateReadingTime(wordCount);
  
  e.model.set("word_count", wordCount);
  e.model.set("reading_time", readingTime);
  
  return e.next();
}, "documents");
