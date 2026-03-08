export interface NoticePost {
  slug: string;
  title: {
    en: string;
    ko: string;
  };
  description: {
    en: string;
    ko: string;
  };
  content: {
    en: string;
    ko: string;
  };
  date: string;
  author: string;
  tags: string[];
  image?: string;
}

export const noticePosts: NoticePost[] = [
  {
    slug: 'v4-1-1-update',
    title: {
      en: 'UniPad v4.1.1 Update Notes',
      ko: 'UniPad v4.1.1 업데이트 공지',
    },
    description: {
      en: 'Practice mode, theme system changes, MIDI improvements, UI updates, and stability fixes.',
      ko: '연습 모드 추가, 테마 방식 변경, MIDI 개선, UI 변경, 안정성 개선 등의 업데이트 사항을 안내합니다.',
    },
    content: {
      en: `Hello, this is Jisub Kim, the developer of UniPad.

I sincerely apologize for the long gap since the last update. Thank you to everyone who has waited patiently — here are a few improvements, small but meaningful.

## Practice Mode

A new practice mode has been added, allowing you to follow along with autoplay sequences.

- Pads you need to press are shown in advance via guide LEDs
- The guide LEDs gradually brighten to indicate timing
- Playback automatically pauses at chain transitions so you can practice at your own pace
- Guide display is synchronized to the Launchpad as well

## Theme System Changes

Support for the APK-based theme format has been discontinued. Please use ZIP-based themes going forward. Two default themes are now built into the app and ready to use without any additional installation.

## MIDI Connection Improvements

- Automatically enters Programmer Mode when connecting a Launchpad X, Pro, or Pro MK3
- Launchpad Mini MK3 is now supported
- LED response speed has been improved

## UI Changes

- The left panel on the Play screen has a new design
- Loading progress is now visible when opening a UniPack
- The MIDI device selection screen has been redesigned as a grid layout for easier browsing
- Dialog designs have been unified for consistency

## Stability Improvements

- Fixed crashes that occurred with certain UniPacks
- Fixed an issue where the app would freeze during downloads
- Improved recognition of UniPack files in various formats
- Fixed a bug where the background was clipped on wide screens

This app still has room to grow, but I'll continue improving it steadily. Bug reports and suggestions are always welcome. Thank you!`,
      ko: `안녕하세요, UniPad 개발자 김지섭입니다.

오랫동안 업데이트를 드리지 못해 정말 죄송합니다. 그동안 기다려주신 분들께 감사드리며, 소소하지만 몇 가지 개선 사항을 안내드립니다.

## 연습 모드

오토플레이 시퀀스를 보면서 따라 칠 수 있는 연습 모드가 추가되었습니다.

- 눌러야 할 패드가 미리 가이드 LED로 표시됩니다
- 가이드 LED가 점차 밝아지면서 타이밍을 알려줍니다
- 체인이 바뀔 때 자동으로 대기하여 본인의 속도에 맞춰 연습할 수 있습니다
- 런치패드에도 가이드가 동기화됩니다

## 테마 방식 변경

기존 APK 방식의 테마 지원이 종료되었습니다. 앞으로는 ZIP 방식의 테마를 사용해 주세요. 기본 테마 2개가 앱에 내장되어 있어 별도 설치 없이 바로 사용할 수 있습니다.

## MIDI 연결 개선

- Launchpad X, Pro, Pro MK3 연결 시 Programmer Mode에 자동으로 진입합니다
- Launchpad Mini MK3을 지원합니다
- LED 반응 속도가 개선되었습니다

## UI 변경

- Play 화면 좌측 패널이 새로운 디자인으로 바뀌었습니다
- 유니팩 로딩 시 진행 상태를 확인할 수 있습니다
- MIDI 장비 선택 화면이 그리드 레이아웃으로 변경되어 한눈에 확인할 수 있습니다
- 다이얼로그 디자인이 통일되었습니다

## 안정성 개선

- 일부 유니팩에서 발생하던 크래시가 수정되었습니다
- 다운로드 시 앱이 멈추는 문제가 해결되었습니다
- 다양한 형식의 유니팩 파일을 더 잘 인식합니다
- 와이드 화면에서 배경이 잘려 보이던 문제가 수정되었습니다

부족한 앱이지만 앞으로도 꾸준히 개선해 나가겠습니다. 버그 리포트나 건의사항은 언제든 환영합니다. 감사합니다!`,
    },
    date: '2026-03-08',
    author: 'Kimjisub',
    tags: ['v4.1.1'],
  },
  {
    slug: 'storage-system',
    title: {
      en: 'Storage System Changes',
      ko: '스토리지 시스템 변경사항',
    },
    description: {
      en: 'Storage changes in UniPad 4.0.0 due to Android 10 policy updates.',
      ko: 'Android 10 정책 변경으로 인한 UniPad 4.0.0 저장소 관련 변경사항입니다.',
    },
    content: {
      en: `## Previous Version

In the previous version of UniPad, UniPacks were stored in the public storage at \`/storage/emulated/0/Unipad\`, allowing access through third-party apps. However, due to Android 10 policy changes, access to this location became impossible without special permissions, causing issues for users with newer Android devices.

## Update

Accordingly, the UniPack storage path has been changed from public storage to the app's internal storage.

![Storage System](/notices/storage-system-image1.png)

## Developer Notes

The following is for developers.

We made several attempts to support Android 10's Scoped Storage.`,
      ko: `## 이전 버전

이전 버전의 유니패드에서는 공용 저장소 공간인 \`/storage/emulated/0/Unipad\`에 유니팩을 저장하여 서드파티 앱을 통해서 유니팩에 접근할 수 있었습니다. 하지만 Android 10 정책 변경으로 인하여 특수한 권한 없이는 해당 위치에 접근이 불가능하게 되었고, 그동안 최신 버전의 안드로이드 기기에서는 유니패드 사용이 불가능하던 문제가 있었습니다.

## 업데이트 내용

이에 따라 공용 저장소가 아닌 앱 내부 저장소로 유니팩 저장 경로를 수정하였습니다.

![스토리지 시스템](/notices/storage-system-image1.png)

## 개발자의 고찰

아래 내용은 개발자들을 위한 내용입니다.

Android 10의 Scoped Storage를 지원하기 위해서 했던 여러가지 시도들을 했습니다.`,
    },
    date: '2021-11-02',
    author: 'Kimjisub',
    tags: ['4.0.0'],
    image: '/notices/storage-system-image1.png',
  },
];

export function getNoticePost(slug: string): NoticePost | undefined {
  return noticePosts.find((post) => post.slug === slug);
}

export function getAllNoticePosts(): NoticePost[] {
  return noticePosts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
