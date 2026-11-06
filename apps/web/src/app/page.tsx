import {Terminal} from '../components/terminal';
import {deploymentMode} from '../lib/server/deployment';
export const dynamic = 'force-dynamic';
export default function Page(){return <Terminal deploymentMode={deploymentMode()}/>}
