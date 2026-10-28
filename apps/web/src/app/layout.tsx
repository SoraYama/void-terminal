import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'void-terminal · 虚空终端',description:'循着原文，读懂故事与世界。非官方原神知识站。'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN" suppressHydrationWarning><body>{children}</body></html>}
