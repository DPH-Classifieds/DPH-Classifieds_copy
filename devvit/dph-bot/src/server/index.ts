import {createServer, getServerPort} from '@devvit/web/server'
import {onReq} from './server.ts'

const server = createServer(onReq)
server.on('error', err => console.error(`server error; ${err.stack}`))
server.listen(getServerPort(), () => console.log('dph-bot server started'))
