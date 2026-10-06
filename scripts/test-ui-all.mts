import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

const screenshotDir=process.env.APP_SCREENSHOT_DIR ?? "/private/tmp/english-coach-qa";
await mkdir(screenshotDir,{recursive:true});
const chromium=process.env.CHROMIUM_PATH ?? (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/chromium");
for(const script of ["test-personalized-quiz.mts","test-conversation.mts","test-speech.mts","test-learning-loop.mts","test-words.mts","test-workflow.mts"]){
  const result=spawnSync(process.execPath,[`scripts/${script}`],{stdio:"inherit",env:{...process.env,
    CHROMIUM_PATH:chromium,QUIZ_SCREENSHOT_DIR:screenshotDir,CONVERSATION_SCREENSHOT_DIR:screenshotDir,SPEECH_SCREENSHOT_DIR:screenshotDir,
    LEARNING_SCREENSHOT_DIR:screenshotDir,WORD_SCREENSHOT_DIR:screenshotDir,WORKFLOW_SCREENSHOT_DIR:screenshotDir}});
  if(result.error) throw result.error;
  if(result.status !== 0) process.exit(result.status ?? 1);
}
