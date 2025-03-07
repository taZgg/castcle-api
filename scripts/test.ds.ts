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


import * as AWS from 'aws-sdk';
const Configs = {
  PredictSuggestionFunctionName: 'dev-ds-predict-friend-to-follow',
  Suggestion:{
    MinContent:6,
    MinDiffTime:15000,
    SuggestAmount: 2,
  }
}
type SuggestionType ={ 
  statusCode : number,
  predicted_at : string,
  result : { result : { userId: string, engagements: number, index:number }[]}
}

const predictSuggestion = (accountId: string) => {
  const lambda = new AWS.Lambda({ region: 'us-east-1' });

  return new Promise<SuggestionType>((resolve, reject) => {
    console.time('Spend time on AWS lambda');

    lambda.invoke(
      {
        FunctionName: Configs.PredictSuggestionFunctionName,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({ userId:accountId }),
      },
      (err, data) => {
        console.timeEnd('Spend time on AWS lambda');

        err ? reject(err) : resolve(JSON.parse(data.Payload as string).result);
      }
    );
  });
};

const init = async () => {
  console.log('test ds user predict')
  const result = await predictSuggestion("6170063351db852b0e6d20fc");
  console.log(JSON.stringify(result));
}
init();