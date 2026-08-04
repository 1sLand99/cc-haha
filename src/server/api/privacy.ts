/**
 * Privacy REST API
 *
 * GET  /api/privacy/non-essential-traffic  — 获取"禁用非必要外部流量"开关
 * PUT  /api/privacy/non-essential-traffic  — 更新开关（同步当前进程 env）
 */

import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import {
  readNonEssentialTrafficDisabled,
  updateNonEssentialTrafficDisabled,
} from '../../services/api/nonEssentialTraffic.js'

export async function handlePrivacyApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const sub = segments[2] // 'non-essential-traffic' | undefined

    if (sub === 'non-essential-traffic') {
      if (req.method === 'GET') {
        return Response.json({ disabled: await readNonEssentialTrafficDisabled() })
      }
      if (req.method === 'PUT') {
        const body = await parseJsonBody(req)
        if (typeof body.disabled !== 'boolean') {
          throw ApiError.badRequest('Missing or invalid "disabled" in request body')
        }
        return Response.json(await updateNonEssentialTrafficDisabled(body.disabled))
      }
      throw methodNotAllowed(req.method)
    }

    throw ApiError.notFound(`Unknown privacy endpoint: ${sub}`)
  } catch (error) {
    return errorResponse(error)
  }
}

function methodNotAllowed(method: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED')
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}
