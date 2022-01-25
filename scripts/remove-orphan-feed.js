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

async function removeOrphanFeedItems (){
  console.log('start to delete')
  const cursor =await client.db(process.env.DB_DATABASE_NAME).collection('guestfeeditems').aggregate([
    {
      '$lookup': {
        'from': 'contents', 
        'localField': 'content', 
        'foreignField': '_id', 
        'as': 'newContent'
      }
    }, {
      '$match': {
        'newContent': []
      }
    }, {
      '$project': {
        '_id': '$_id'
      }
    }
  ])
  console.log('get data')
  cursor.forEach(item => {
    console.log('each one')
    console.log('delete feeds', item._id)
    client.db(process.env.DB_DATABASE_NAME).collection('feeditems').deleteOne({_id:item._id});
  })
  //cursor.forEach(console.dir)
  
  
}

async function init(){
  console.log('connecting ', db_uri);
  await client.connect();
  console.log('done connect query contents, getting content that has create before', markDate.toISOString(), 'in db ', process.env.DB_DATABASE_NAME);
  removeOrphanFeedItems();

}

init();