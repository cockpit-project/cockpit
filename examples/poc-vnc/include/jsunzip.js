/*
 * JSUnzip
 *
 * Copyright (c) 2011 by Erik Moller
 * All Rights Reserved
 *
 * This software is provided 'as-is', without any express
 * or implied warranty.  In no event will the authors be
 * held liable for any damages arising from the use of
 * this software.
 *
 * Permission is granted to anyone to use this software
 * for any purpose, including commercial applications,
 * and to alter it and redistribute it freely, subject to
 * the following restrictions:
 *
 * 1. The origin of this software must not be
 *    misrepresented; you must not claim that you
 *    wrote the original software. If you use this
 *    software in a product, an acknowledgment in
 *    the product documentation would be appreciated
 *    but is not required.
 *
 * 2. Altered source versions must be plainly marked
 *    as such, and must not be misrepresented as
 *    being the original software.
 *
 * 3. This notice may not be removed or altered from
 *    any source distribution.
 */
 
var tinf;

function JSUnzip() {

    this.getInt = function(offset, size) {
        switch (size) {
        case 4:
            return  (this.data.charCodeAt(offset + 3) & 0xff) << 24 | 
                    (this.data.charCodeAt(offset + 2) & 0xff) << 16 | 
                    (this.data.charCodeAt(offset + 1) & 0xff) << 8 | 
                    (this.data.charCodeAt(offset + 0) & 0xff);
            break;
        case 2:
            return  (this.data.charCodeAt(offset + 1) & 0xff) << 8 | 
                    (this.data.charCodeAt(offset + 0) & 0xff);
            break;
        default:
            return this.data.charCodeAt(offset) & 0xff;
            break;
        }
    };

    this.getDOSDate = function(dosdate, dostime) {
        var day = dosdate & 0x1f;
        var month = ((dosdate >> 5) & 0xf) - 1;
        var year = 1980 + ((dosdate >> 9) & 0x7f)
        var second = (dostime & 0x1f) * 2;
        var minute = (dostime >> 5) & 0x3f;
        hour = (dostime >> 11) & 0x1f;
        return new Date(year, month, day, hour, minute, second);
    }

    this.open = function(data) {
        this.data = data;
        this.files = [];

        if (this.data.length < 22)
            return { 'status' : false, 'error' : 'Invalid data' };
        var endOfCentralDirectory = this.data.length - 22;
        while (endOfCentralDirectory >= 0 && this.getInt(endOfCentralDirectory, 4) != 0x06054b50)
            --endOfCentralDirectory;
        if (endOfCentralDirectory < 0)
            return { 'status' : false, 'error' : 'Invalid data' };
        if (this.getInt(endOfCentralDirectory + 4, 2) != 0 || this.getInt(endOfCentralDirectory + 6, 2) != 0)
            return { 'status' : false, 'error' : 'No multidisk support' };

        var entriesInThisDisk = this.getInt(endOfCentralDirectory + 8, 2);
        var centralDirectoryOffset = this.getInt(endOfCentralDirectory + 16, 4);
        var globalCommentLength = this.getInt(endOfCentralDirectory + 20, 2);
        this.comment = this.data.slice(endOfCentralDirectory + 22, endOfCentralDirectory + 22 + globalCommentLength);

        var fileOffset = centralDirectoryOffset;

        for (var i = 0; i < entriesInThisDisk; ++i) {
            if (this.getInt(fileOffset + 0, 4) != 0x02014b50)
                return { 'status' : false, 'error' : 'Invalid data' };
            if (this.getInt(fileOffset + 6, 2) > 20)
                return { 'status' : false, 'error' : 'Unsupported version' };
            if (this.getInt(fileOffset + 8, 2) & 1)
                return { 'status' : false, 'error' : 'Encryption not implemented' };

            var compressionMethod = this.getInt(fileOffset + 10, 2);
            if (compressionMethod != 0 && compressionMethod != 8)
                return { 'status' : false, 'error' : 'Unsupported compression method' };

            var lastModFileTime = this.getInt(fileOffset + 12, 2);
            var lastModFileDate = this.getInt(fileOffset + 14, 2);
            var lastModifiedDate = this.getDOSDate(lastModFileDate, lastModFileTime);

            var crc = this.getInt(fileOffset + 16, 4);
            // TODO: crc

            var compressedSize = this.getInt(fileOffset + 20, 4);
            var uncompressedSize = this.getInt(fileOffset + 24, 4);

            var fileNameLength = this.getInt(fileOffset + 28, 2);
            var extraFieldLength = this.getInt(fileOffset + 30, 2);
            var fileCommentLength = this.getInt(fileOffset + 32, 2);

            var relativeOffsetOfLocalHeader = this.getInt(fileOffset + 42, 4);

            var fileName = this.data.slice(fileOffset + 46, fileOffset + 46 + fileNameLength);
            var fileComment = this.data.slice(fileOffset + 46 + fileNameLength + extraFieldLength, fileOffset + 46 + fileNameLength + extraFieldLength + fileCommentLength);

            if (this.getInt(relativeOffsetOfLocalHeader + 0, 4) != 0x04034b50)
                return { 'status' : false, 'error' : 'Invalid data' };
            var localFileNameLength = this.getInt(relativeOffsetOfLocalHeader + 26, 2);
            var localExtraFieldLength = this.getInt(relativeOffsetOfLocalHeader + 28, 2);
            var localFileContent = relativeOffsetOfLocalHeader + 30 + localFileNameLength + localExtraFieldLength;

            this.files[fileName] = 
            {
                'fileComment' : fileComment,
                'compressionMethod' : compressionMethod,
                'compressedSize' : compressedSize,
                'uncompressedSize' : uncompressedSize,
                'localFileContent' : localFileContent,
                'lastModifiedDate' : lastModifiedDate
            };

            fileOffset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
        }
        return { 'status' : true }
    };     
    

    this.read = function(fileName) {
        var fileInfo = this.files[fileName];
        if (fileInfo) {
            if (fileInfo.compressionMethod == 8) {
                if (!tinf) {
                    tinf = new TINF();
                    tinf.init();
                }
                var result = tinf.uncompress(this.data, fileInfo.localFileContent);
                if (result.status == tinf.OK)
                    return { 'status' : true, 'data' : result.data };
                else
                    return { 'status' : false, 'error' : result.error };
            } else {
                return { 'status' : true, 'data' : this.data.slice(fileInfo.localFileContent, fileInfo.localFileContent + fileInfo.uncompressedSize) };
            }
        }
        return { 'status' : false, 'error' : "File '" + fileName + "' doesn't exist in zip" };
    };
    
};



/*
 * tinflate  -  tiny inflate
 *
 * Copyright (c) 2003 by Joergen Ibsen / Jibz
 * All Rights Reserved
 *
 * http://www.ibsensoftware.com/
 *
 * This software is provided 'as-is', without any express
 * or implied warranty.  In no event will the authors be
 * held liable for any damages arising from the use of
 * this software.
 *
 * Permission is granted to anyone to use this software
 * for any purpose, including commercial applications,
 * and to alter it and redistribute it freely, subject to
 * the following restrictions:
 *
 * 1. The origin of this software must not be
 *    misrepresented; you must not claim that you
 *    wrote the original software. If you use this
 *    software in a product, an acknowledgment in
 *    the product documentation would be appreciated
 *    but is not required.
 *
 * 2. Altered source versions must be plainly marked
 *    as such, and must not be misrepresented as
 *    being the original software.
 *
 * 3. This notice may not be removed or altered from
 *    any source distribution.
 */

/*
 * tinflate javascript port by Erik Moller in May 2011.
 * emoller@opera.com
 * 
 * read_bits() patched by mike@imidio.com to allow
 * reading more then 8 bits (needed in some zlib streams)
 */

"use strict";

function TINF() {
    
this.OK = 0;
this.DATA_ERROR = (-3);
this.WINDOW_SIZE = 32768;

/* ------------------------------ *
 * -- internal data structures -- *
 * ------------------------------ */

this.TREE = function() {
   this.table = new Array(16);  /* table of code length counts */
   this.trans = new Array(288); /* code -> symbol translation table */
};

this.DATA = function(that) {
   this.source = '';
   this.sourceIndex = 0;
   this.tag = 0;
   this.bitcount = 0;

   this.dest = [];
   
   this.history = [];

   this.ltree = new that.TREE(); /* dynamic length/symbol tree */
   this.dtree = new that.TREE(); /* dynamic distance tree */
};

/* --------------------------------------------------- *
 * -- uninitialized global data (static structures) -- *
 * --------------------------------------------------- */

this.sltree = new this.TREE(); /* fixed length/symbol tree */
this.sdtree = new this.TREE(); /* fixed distance tree */

/* extra bits and base tables for length codes */
this.length_bits = new Array(30);
this.length_base = new Array(30);

/* extra bits and base tables for distance codes */
this.dist_bits = new Array(30);
this.dist_base = new Array(30);

/* special ordering of code length codes */
this.clcidx = [
   16, 17, 18, 0, 8, 7, 9, 6,
   10, 5, 11, 4, 12, 3, 13, 2,
   14, 1, 15
];

/* ----------------------- *
 * -- utility functions -- *
 * ----------------------- */

/* build extra bits and base tables */
this.build_bits_base = function(bits, base, delta, first)
{
   var i, sum;

   /* build bits table */
   for (i = 0; i < delta; ++i) bits[i] = 0;
   for (i = 0; i < 30 - delta; ++i) bits[i + delta] = Math.floor(i / delta);

   /* build base table */
   for (sum = first, i = 0; i < 30; ++i)
   {
      base[i] = sum;
      sum += 1 << bits[i];
   }
}

/* build the fixed huffman trees */
this.build_fixed_trees = function(lt, dt)
{
   var i;

   /* build fixed length tree */
   for (i = 0; i < 7; ++i) lt.table[i] = 0;

   lt.table[7] = 24;
   lt.table[8] = 152;
   lt.table[9] = 112;

   for (i = 0; i < 24; ++i) lt.trans[i] = 256 + i;
   for (i = 0; i < 144; ++i) lt.trans[24 + i] = i;
   for (i = 0; i < 8; ++i) lt.trans[24 + 144 + i] = 280 + i;
   for (i = 0; i < 112; ++i) lt.trans[24 + 144 + 8 + i] = 144 + i;

   /* build fixed distance tree */
   for (i = 0; i < 5; ++i) dt.table[i] = 0;

   dt.table[5] = 32;

   for (i = 0; i < 32; ++i) dt.trans[i] = i;
}

/* given an array of code lengths, build a tree */
this.build_tree = function(t, lengths, loffset, num)
{
   var offs = new Array(16);
   var i, sum;

   /* clear code length count table */
   for (i = 0; i < 16; ++i) t.table[i] = 0;

   /* scan symbol lengths, and sum code length counts */
   for (i = 0; i < num; ++i) t.table[lengths[loffset + i]]++;

   t.table[0] = 0;

   /* compute offset table for distribution sort */
   for (sum = 0, i = 0; i < 16; ++i)
   {
      offs[i] = sum;
      sum += t.table[i];
   }

   /* create code->symbol translation table (symbols sorted by code) */
   for (i = 0; i < num; ++i)
   {
      if (lengths[loffset + i]) t.trans[offs[lengths[loffset + i]]++] = i;
   }
}

/* ---------------------- *
 * -- decode functions -- *
 * ---------------------- */

/* get one bit from source stream */
this.getbit = function(d)
{
   var bit;

   /* check if tag is empty */
   if (!d.bitcount--)
   {
      /* load next tag */
      d.tag = d.source[d.sourceIndex++] & 0xff;
      d.bitcount = 7;
   }

   /* shift bit out of tag */
   bit = d.tag & 0x01;
   d.tag >>= 1;

   return bit;
}

/* read a num bit value from a stream and add base */
function read_bits_direct(source, bitcount, tag, idx, num)
{
    var val = 0;
    while (bitcount < 24) {
        tag = tag | (source[idx++] & 0xff) << bitcount;
        bitcount += 8;
    }
    val = tag & (0xffff >> (16 - num));
    tag >>= num;
    bitcount -= num;
    return [bitcount, tag, idx, val];
}
this.read_bits = function(d, num, base)
{
    if (!num)
        return base;

    var ret = read_bits_direct(d.source, d.bitcount, d.tag, d.sourceIndex, num);
    d.bitcount = ret[0];
    d.tag = ret[1];
    d.sourceIndex = ret[2];
    return ret[3] + base;
}

/* given a data stream and a tree, decode a symbol */
this.decode_symbol = function(d, t)
{
    while (d.bitcount < 16) {
        d.tag = d.tag | (d.source[d.sourceIndex++] & 0xff) << d.bitcount;
        d.bitcount += 8;
    }
    
    var sum = 0, cur = 0, len = 0;
    do {
        cur = 2 * cur + ((d.tag & (1 << len)) >> len);

        ++len;

        sum += t.table[len];
        cur -= t.table[len];

    } while (cur >= 0);

    d.tag >>= len;
    d.bitcount -= len;

    return t.trans[sum + cur];
}

/* given a data stream, decode dynamic trees from it */
this.decode_trees = function(d, lt, dt)
{
   var code_tree = new this.TREE();
   var lengths = new Array(288+32);
   var hlit, hdist, hclen;
   var i, num, length;

   /* get 5 bits HLIT (257-286) */
   hlit = this.read_bits(d, 5, 257);

   /* get 5 bits HDIST (1-32) */
   hdist = this.read_bits(d, 5, 1);

   /* get 4 bits HCLEN (4-19) */
   hclen = this.read_bits(d, 4, 4);

   for (i = 0; i < 19; ++i) lengths[i] = 0;

   /* read code lengths for code length alphabet */
   for (i = 0; i < hclen; ++i)
   {
      /* get 3 bits code length (0-7) */
      var clen = this.read_bits(d, 3, 0);

      lengths[this.clcidx[i]] = clen;
   }

   /* build code length tree */
   this.build_tree(code_tree, lengths, 0, 19);

   /* decode code lengths for the dynamic trees */
   for (num = 0; num < hlit + hdist; )
   {
      var sym = this.decode_symbol(d, code_tree);

      switch (sym)
      {
      case 16:
         /* copy previous code length 3-6 times (read 2 bits) */
         {
            var prev = lengths[num - 1];
            for (length = this.read_bits(d, 2, 3); length; --length)
            {
               lengths[num++] = prev;
            }
         }
         break;
      case 17:
         /* repeat code length 0 for 3-10 times (read 3 bits) */
         for (length = this.read_bits(d, 3, 3); length; --length)
         {
            lengths[num++] = 0;
         }
         break;
      case 18:
         /* repeat code length 0 for 11-138 times (read 7 bits) */
         for (length = this.read_bits(d, 7, 11); length; --length)
         {
            lengths[num++] = 0;
         }
         break;
      default:
         /* values 0-15 represent the actual code lengths */
         lengths[num++] = sym;
         break;
      }
   }

   /* build dynamic trees */
   this.build_tree(lt, lengths, 0, hlit);
   this.build_tree(dt, lengths, hlit, hdist);
}

/* ----------------------------- *
 * -- block inflate functions -- *
 * ----------------------------- */

/* given a stream and two trees, inflate a block of data */
this.inflate_block_data = function(d, lt, dt)
{
   // js optimization.
   var ddest = d.dest;
   var ddestlength = ddest.length;

   while (1)
   {
      var sym = this.decode_symbol(d, lt);

      /* check for end of block */
      if (sym == 256)
      {
         return this.OK;
      }

      if (sym < 256)
      {
         ddest[ddestlength++] = sym; // ? String.fromCharCode(sym);
         d.history.push(sym);
      } else {

         var length, dist, offs;
         var i;

         sym -= 257;

         /* possibly get more bits from length code */
         length = this.read_bits(d, this.length_bits[sym], this.length_base[sym]);

         dist = this.decode_symbol(d, dt);

         /* possibly get more bits from distance code */
         offs = d.history.length - this.read_bits(d, this.dist_bits[dist], this.dist_base[dist]);

         if (offs < 0)
             throw ("Invalid zlib offset " + offs);
         
         /* copy match */
         for (i = offs; i < offs + length; ++i) {
            //ddest[ddestlength++] = ddest[i];
            ddest[ddestlength++] = d.history[i];
            d.history.push(d.history[i]);
         }
      }
   }
}

/* inflate an uncompressed block of data */
this.inflate_uncompressed_block = function(d)
{
   var length, invlength;
   var i;

   if (d.bitcount > 7) {
       var overflow = Math.floor(d.bitcount / 8);
       d.sourceIndex -= overflow;
       d.bitcount = 0;
       d.tag = 0;
   }
   
   /* get length */
   length = d.source[d.sourceIndex+1];
   length = 256*length + d.source[d.sourceIndex];

   /* get one's complement of length */
   invlength = d.source[d.sourceIndex+3];
   invlength = 256*invlength + d.source[d.sourceIndex+2];

   /* check length */
   if (length != (~invlength & 0x0000ffff)) return this.DATA_ERROR;

   d.sourceIndex += 4;

   /* copy block */
   for (i = length; i; --i) {
       d.history.push(d.source[d.sourceIndex]);
       d.dest[d.dest.length] = d.source[d.sourceIndex++];
   }

   /* make sure we start next block on a byte boundary */
   d.bitcount = 0;

   return this.OK;
}

/* inflate a block of data compressed with fixed huffman trees */
this.inflate_fixed_block = function(d)
{
   /* decode block using fixed trees */
   return this.inflate_block_data(d, this.sltree, this.sdtree);
}

/* inflate a block of data compressed with dynamic huffman trees */
this.inflate_dynamic_block = function(d)
{
   /* decode trees from stream */
   this.decode_trees(d, d.ltree, d.dtree);

   /* decode block using decoded trees */
   return this.inflate_block_data(d, d.ltree, d.dtree);
}

/* ---------------------- *
 * -- public functions -- *
 * ---------------------- */

/* initialize global (static) data */
this.init = function()
{
   /* build fixed huffman trees */
   this.build_fixed_trees(this.sltree, this.sdtree);

   /* build extra bits and base tables */
   this.build_bits_base(this.length_bits, this.length_base, 4, 3);
   this.build_bits_base(this.dist_bits, this.dist_base, 2, 1);

   /* fix a special case */
   this.length_bits[28] = 0;
   this.length_base[28] = 258;

   this.reset();   
}

this.reset = function()
{
   this.d = new this.DATA(this);
   delete this.header;
}

/* inflate stream from source to dest */
this.uncompress = function(source, offset)
{

   var d = this.d;
   var bfinal;

   /* initialise data */
   d.source = source;
   d.sourceIndex = offset;
   d.bitcount = 0;

   d.dest = [];

   // Skip zlib header at start of stream
   if (typeof this.header == 'undefined') {
       this.header = this.read_bits(d, 16, 0);
       /* byte 0: 0x78, 7 = 32k window size, 8 = deflate */
       /* byte 1: check bits for header and other flags */
   }

   var blocks = 0;
   
   do {

      var btype;
      var res;

      /* read final block flag */
      bfinal = this.getbit(d);

      /* read block type (2 bits) */
      btype = this.read_bits(d, 2, 0);

      /* decompress block */
      switch (btype)
      {
      case 0:
         /* decompress uncompressed block */
         res = this.inflate_uncompressed_block(d);
         break;
      case 1:
         /* decompress block with fixed huffman trees */
         res = this.inflate_fixed_block(d);
         break;
      case 2:
         /* decompress block with dynamic huffman trees */
         res = this.inflate_dynamic_block(d);
         break;
      default:
         return { 'status' : this.DATA_ERROR };
      }

      if (res != this.OK) return { 'status' : this.DATA_ERROR };
      blocks++;
      
   } while (!bfinal && d.sourceIndex < d.source.length);

   d.history = d.history.slice(-this.WINDOW_SIZE);
   
   return { 'status' : this.OK, 'data' : d.dest };
}

};
