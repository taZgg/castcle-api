/*
 * Copyright (c) 2021, Castcle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * This code is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 3 only, as
 * published by the Free Software Foundation.
 *
 * This code is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License
 * version 3 for more details (a copy is included in the LICENSE file that
 * accompanied this code).
 *
 * You should have received a copy of the GNU General Public License version
 * 3 along with this work; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA 02110-1301 USA.
 *
 * Please contact Castcle, 22 Phet Kasem 47/2 Alley, Bang Khae, Bangkok,
 * Thailand 10160, or visit www.castcle.com if you need additional information
 * or have any questions.
 */

import { Request } from 'express';
import { CastcleException, CastcleStatus } from '@castcle-api/utils/exception';

export const getTokenFromRequest = (request: Request) => {
  const token = request.headers.authorization?.split(' ')?.[1];

  if (!token) throw CastcleException.MISSING_AUTHORIZATION_HEADERS;

  return token;
};

export const getLanguageFromRequest = (request: Request) => {
  const language = request.headers['accept-language'];

  if (!language) throw CastcleException.MISSING_AUTHORIZATION_HEADERS;

  return language;
};

/**
 * get ip from current request
 * @param {Request} request
 */
export const getIpFromRequest = (request: Request) => {
  /** Example: `API-Metadata="ip=127.0.0.1,src=iOS,dest=castcle-authentications"` */
  const API_METADATA_PATTERN = /ip=(\d+\.\d+\.\d+\.\d+),src=(\w+),dest=(.+)/;
  const metadata = request.headers['api-metadata'] as string;
  const ip = metadata?.match(API_METADATA_PATTERN)?.[1];

  if (!ip) throw new CastcleException(CastcleStatus.INVALID_FORMAT);

  return ip;
};
