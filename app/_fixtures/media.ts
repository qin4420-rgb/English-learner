import type { MediaSegment } from "../types";

export const DEVELOPMENT_VIDEO_FIXTURE = {
  src: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  title: "Media Player 开发验收 Fixture",
  segments: [
    { id: "fixture-1", startMs: 0, endMs: 4000, originalText: "Development fixture: the first synchronized segment.", translationText: "开发测试：第一条同步文字稿。" },
    { id: "fixture-2", startMs: 4000, endMs: 8000, originalText: "Click this line to seek the video to four seconds.", translationText: "点击本句会把视频定位到第四秒。" },
    { id: "fixture-3", startMs: 8000, endMs: 12000, originalText: "Loop mode repeats only the selected segment.", translationText: "循环模式只重复当前句。" },
  ] satisfies MediaSegment[],
};
