/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

package main

import (
	"cockpit-kube-auth/helpers"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"syscall"
)

const MAX_BUFFER = 64 * 1024
const AUTH_FD = 3

func jsonError(err error) ([]byte, error) {
	log.Println(err)
	errorType := "Unexpected Error"
	if _, ok := err.(*helpers.AuthError); ok {
		errorType = "authentication-failed"
	}

	data := map[string]string{
		"error":   errorType,
		"message": fmt.Sprintf("%s", err),
	}
	return json.Marshal(data)
}

func readData(fd int) ([]byte, error) {
	/* No EOF is expected so read
	 * from the fd upto the max size
	 * only return what is actually
	 * read.
	 */
	result := make([]byte, MAX_BUFFER)
	n, err := syscall.Read(fd, result)
	if err != nil {
		return nil, err
	}

	return result[:n], nil
}

func sendAuthResponse(fd int, response []byte) {
	_, err := syscall.Write(fd, response)
	if err != nil {
		log.Fatalf("Could't write authentication reponse %s", err)
	}
}

func main() {
	authType := os.Getenv("COCKPIT_AUTH_MESSAGE_TYPE")
	authData, err := readData(AUTH_FD)
	if err != nil {
		log.Fatal("Error reading authentication data ", err)
	}

	client := helpers.NewClient()
	response, loginErr := client.Login(authType, string(authData))
	if loginErr != nil {
		var respErr error
		response, respErr = jsonError(loginErr)
		if respErr != nil {
			log.Fatal("Error generating response ", respErr)
		}
	}

	sendAuthResponse(AUTH_FD, response)
	e := syscall.Close(AUTH_FD)
	if e != nil {
		log.Fatal("Error closing auth FD ", e)
	}

	if loginErr == nil {
		if os.Getenv("XDG_RUNTIME_DIR") == "" {
			os.Setenv("XDG_RUNTIME_DIR", "/tmp")
		}
		syscall.Exec("/usr/libexec/cockpit-stub", nil, os.Environ())
	}
}
