# 주아방 (JUAbang)

집에서 부르는 노래방. 마이크 소리를 에코와 함께 스피커로 내보내고, 노래와 자막을 띄운다.

- PC 앱 (Windows 설치형): 유튜브 노래방 영상·원곡 받기, 파일 올리기, 가사 자동 붙이기, 마이크 2개, 에코, 목소리 줄이기, 녹음
- 웹앱 (폰): 같은 화면. 유튜브 링크 붙여 넣어 부르기, 파일 올리기, 마이크·에코

## 개발

```
npm install
curl -L -o vendor/yt-dlp.exe https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
npm start        # PC 앱 실행
npm run web      # 웹(폰) 버전 미리 보기 → http://localhost:5173
npm run dist     # 설치 파일 만들기 → dist/JUAbang-Setup-x.y.z.exe
```

받은 노래는 `음악\주아방 노래` 폴더에 저장된다.
