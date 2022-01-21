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

const { MongoClient } = require("mongodb");
require('dotenv').config();
const DELETE_UNTIL_CONTENT_DATE = '2022-01-01 00:00:00';
const markDate = new Date(Date.parse(DELETE_UNTIL_CONTENT_DATE.replace(/-/g, '/')));
const db_user_pass =
  process.env.DB_USERNAME === '' && process.env.DB_PASSWORD === ''
    ? ''
    : `${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@`;
const db_query =
  process.env.DB_HOST === 'localhost' ? '' : '?retryWrites=true&w=majority';
const db_uri = `mongodb+srv://${db_user_pass}${process.env.DB_HOST}`

const client = new MongoClient(db_uri);

async function processContent(contentDocument){
  console.log(contentDocument._id)
  //remove feed
  let deleteFeedQuery = {};
  deleteFeedQuery['content'] = {id:contentDocument._id};
  console.log('delete feeditems')
   
  console.log('delete guestfeeditems')
  let deleteGuestFeedQuery = {content: contentDocument._id};
   
  console.log('delete contentinfo')
  let deleteContentInfo = {contentId: contentDocument._id};
   
  console.log('delete dscontentreaches')
  let deleteDs = {content: contentDocument._id};
   
  console.log('delete content itself') 
  await Promise.all([ client.db(process.env.DB_DATABASE_NAME).collection('feeditems').deleteMany(deleteFeedQuery),
     client.db(process.env.DB_DATABASE_NAME).collection('guestfeeditems').deleteMany(deleteGuestFeedQuery),
     client.db(process.env.DB_DATABASE_NAME).collection('contentinfo').deleteMany(deleteContentInfo)
    ,client.db(process.env.DB_DATABASE_NAME).collection('dscontentreaches').deleteMany(deleteDs)
    , client.db(process.env.DB_DATABASE_NAME).collection('contents').deleteOne({_id:contentDocument._id})
  ])
  console.log('done');
}

async function init(){
  console.log('connecting ', db_uri);
  await client.connect();
  console.log('done connect query contents, getting content that has create before', markDate.toISOString(), 'in db ', process.env.DB_DATABASE_NAME);
  const cursor =await client.db(process.env.DB_DATABASE_NAME).collection('contents').find({
    createdAt: {
      $lt: markDate
    }
  })
  if ((await cursor.count()) === 0) {
    console.log("No documents found!");
  }else{
    console.log('count', (await cursor.count())) 
  }
  let i = 0;
  cursor.forEach(doc => {
      console.log('test delete', doc._id, i++);
      processContent(doc);
  });
}

init();