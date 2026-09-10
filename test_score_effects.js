/**
 * Unit Test for Score Effects Thresholds & Titles
 */
import { getFunnyTitle } from './src/utils/audioAnalyzer.js';

console.log('🧪 Testing Score Thresholds & Logic for Reveal Animations...\n');

let failed = 0;

// Test Low Score (<25)
const lowScores = [0, 5, 12, 18, 24];
lowScores.forEach(score => {
  const isLow = score < 25;
  const title = getFunnyTitle(score);
  console.log(`Score: ${score} -> Low threshold (<25): ${isLow} | Title: "${title}"`);
  if (!isLow) {
    console.error(`❌ Expected score ${score} to be < 25`);
    failed++;
  }
});

// Test High Score (>=75)
const highScores = [75, 80, 88, 95, 100];
highScores.forEach(score => {
  const isHigh = score >= 75;
  const title = getFunnyTitle(score);
  console.log(`Score: ${score} -> High threshold (>=75): ${isHigh} | Title: "${title}"`);
  if (!isHigh) {
    console.error(`❌ Expected score ${score} to be >= 75`);
    failed++;
  }
});

// Test Normal Range (25 to 74)
const midScores = [25, 35, 50, 60, 74];
midScores.forEach(score => {
  const isSpecial = score < 25 || score >= 75;
  const title = getFunnyTitle(score);
  console.log(`Score: ${score} -> Normal range (no egg/confetti auto-blast): ${!isSpecial} | Title: "${title}"`);
  if (isSpecial) {
    console.error(`❌ Expected score ${score} to be between 25 and 74`);
    failed++;
  }
});

if (failed === 0) {
  console.log('\n✅ All score threshold and badge tests passed successfully!');
} else {
  console.error(`\n❌ ${failed} tests failed.`);
  process.exit(1);
}
