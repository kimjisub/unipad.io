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
