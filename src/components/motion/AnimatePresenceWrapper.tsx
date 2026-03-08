'use client';

import { AnimatePresence } from 'framer-motion';

interface AnimatePresenceWrapperProps {
	children: React.ReactNode;
}

/**
 * layout.tsx (Server Component) 에서 AnimatePresence를 사용하기 위한 클라이언트 래퍼.
 * template.tsx의 exit 애니메이션이 작동하려면 AnimatePresence가 template 바깥에 있어야 함.
 */
export function AnimatePresenceWrapper({ children }: AnimatePresenceWrapperProps) {
	return (
		<AnimatePresence mode="wait" initial={false}>
			{children}
		</AnimatePresence>
	);
}
