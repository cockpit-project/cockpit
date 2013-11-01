#!/usr/bin/perl

# Copyright (C) 2008, Joshua I. Miller E<lt>unrtst@cpan.orgE<gt>, all
# rights reserved.
# 
# This program is free software; you can redistribute it and/or modify it
# under the terms of the GNU Library General Public License as published
# by the Free Software Foundation; either version 2, or (at your option)
# any later version.
# 
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
# Library General Public License for more details.
# 
# You should have received a copy of the GNU Library General Public
# License along with this program; if not, write to the Free Software
# Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307,
# USA.


use strict;
use JSON;
use Locale::PO;
use File::Basename qw(basename);

my $gettext_context_glue = "\004";

sub usage {
    return "$0 {-p} {file.po} > {outputfile.json}
    -p  : do pretty-printing of json data\n";
}

&main;

sub main
{
    my ($src_fh, $src);

    my $pretty = 0;
    if ($ARGV[0] =~ /^--?p$/) {
        shift @ARGV;
        $pretty = 1;
    }

    if (length($ARGV[0]))
    {
        if ($ARGV[0] =~ /^-h/) {
            print &usage;
            exit 1;
        }

        unless (-r $ARGV[0]) {
            print "ERROR: Unable to read file [$ARGV[0]]\n";
            die &usage;
        }

        $src = $ARGV[0];
    } else {
        die &usage;
    }

    # we'll be building this data struct
    my $json = {};

    my $plural_form_count;
    # get po object stack
    my $pos = Locale::PO->load_file_asarray($src) or die "Can't parse po file [$src].";


    foreach my $po (@$pos)
    {
        my $qmsgid1 = $po->msgid;
        my $msgid1 = $po->dequote( $qmsgid1 );

        # on the header
        if (length($msgid1) == 0)
        {
            my $qmsgstr = $po->msgstr;
            my $cur = $po->dequote( $qmsgstr );
            my %cur;
            foreach my $h (split(/\\n/, $cur))
            {
                next unless length($h);
                my @h = split(':', $h, 2);

                if (length($cur{$h[0]})) {
                    warn "SKIPPING DUPLICATE HEADER LINE: $h\n";
                } elsif ($h[0] =~ /#-#-#-#-#/) {
                    warn "SKIPPING ERROR MARKER IN HEADER: $h\n";
                } elsif (@h == 2) {
                    $cur{$h[0]} = $h[1];
                } else {
                    warn "PROBLEM LINE IN HEADER: $h\n";
                    $cur{$h} = '';
                }
            }

            # init header ref
            $$json{''} ||= {};

            # populate header ref
            foreach my $key (keys %cur) {
                $$json{''}{$key} = length($cur{$key}) ? $cur{$key} : '';
            }

            # save plural form count
            if ($$json{''}{'Plural-Forms'}) {
                my $t = $$json{''}{'Plural-Forms'};
                $t =~ s/^\s*//;
                if ($t =~ /nplurals=(\d+)/) {
                    $plural_form_count = $1;
                } else {
                    die "ERROR parsing plural forms header [$t]\n";
                }
            } else {
                warn "NO PLURAL FORM HEADER FOUND - DEFAULTING TO 2\n";
                # just default to 2
                $plural_form_count = 2;
            }

        # on a normal msgid
        } else {
            my $qmsgctxt = $po->msgctxt;
            my $msgctxt = $po->dequote($qmsgctxt) if $qmsgctxt;

            # build the new msgid key
            my $msg_ctxt_id = defined($msgctxt) ? join($gettext_context_glue, ($msgctxt, $msgid1)) : $msgid1;

            # build translation side
            my @trans;

            # msgid plural side
            my $qmsgid_plural = $po->msgid_plural;
            my $msgid2 = $po->dequote( $qmsgid_plural ) if $qmsgid_plural;
            push(@trans, $msgid2);

            # translated string
            # this shows up different if we're plural
            if (defined($msgid2) && length($msgid2))
            {
                my $plurals = $po->msgstr_n;
                for (my $i=0; $i<$plural_form_count; $i++)
                {
                    my $qstr = ref($plurals) ? $$plurals{$i} : undef;
                    my $str  = $po->dequote( $qstr ) if $qstr;
                    push(@trans, $str);
                }

            # singular
            } else {
                my $qmsgstr = $po->msgstr;
                my $msgstr = $po->dequote( $qmsgstr ) if $qmsgstr;
                push(@trans, $msgstr);
            }

            $$json{$msg_ctxt_id} = \@trans;
        }
    }


    my $jsonobj = new JSON;
    my $basename = basename($src);
    $basename =~ s/\.pot?$//;
    if ($pretty)
    {
        print $jsonobj->pretty->encode( { $basename => $json });
    } else {
        print $jsonobj->encode($json);
    }
}

=head1 NAME

po2json - Convert a Uniforum format portable object file to javascript object notation.

=head1 SYNOPSIS

 po2json /path/to/domain.po > domain.json

=head1 DESCRIPTION

This takes a PO file, as is created from GNU Gettext's xgettext, and converts it into a JSON file.

The output is an annonymous associative array. So, if you plan to load this via a <script> tag, more processing will be require (the output from this program must be assigned to a named javascript variable). For example:

    echo -n "var json_locale_data = " > domain.json
    po2json /path/to/domain.po >> domain.json
    echo ";" >> domain.json

=head1 OPTIONS

 -p : pretty-print the output. Makes the output more human-readable.

=head1 BUGS

Locale::PO has a potential bug (I don't know if this actually causes a problem or not). Given a .po file with an entry like:

    msgid ""
    "some string"
    msgstr ""

When $po->dump is run on that entry, it will output:

    msgid "some string"
    msgstr ""

The above is removing the first linebreak. I don't know if that is significant. If so, we'll have to rewrite using a different parser (or include our own parser).

=head1 REQUIRES

 Locale::PO
 JSON

=head1 SEE ALSO

 Locale::PO
 Gettext.js

=head1 AUTHOR

Copyright (C) 2008, Joshua I. Miller E<lt>unrtst@cpan.orgE<gt>, all rights reserved. See the source code for details.



