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
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"syscall"
	"time"
)

type ChallengeResponse struct {
	Cookie   string `json:"cookie"`
	Response string `json:"response"`
	Command  string `json:"command"`
}

func readSize(fd int) (int, error) {
	single := make([]byte, 1)
	sep := byte('\n')
	var size int64 = 0
	seen := 0

	for true {
		_, err := syscall.Read(fd, single)
		if err != nil {
			return -1, err
		}

		if single[0] == sep {
			break
		}

		i, e := strconv.ParseInt(string(single), 10, 64)
		if e != nil {
			return -1, errors.New("Invalid frame: invalid size")
		}

		size = size * 10
		size = size + i
		seen++

		if seen > 7 {
			return -1, errors.New("Invalid frame: size too long")
		}
	}

	return int(size), nil
}

func readFrame(fd int) ([]byte, error) {
	size, sizeErr := readSize(fd)
	if sizeErr != nil {
		return nil, sizeErr
	}
	data := make([]byte, 0)

	for size > 0 {
		buffer := make([]byte, size)
		i, err := syscall.Read(fd, buffer)

		if err != nil {
			return nil, err
		}

		if i == 0 {
			break
		}

		size = size - i
		data = append(data, buffer[:i]...)
	}

	if size > 0 {
		return nil, errors.New(fmt.Sprintf("Invalid frame: Missing %d bytes", size))
	}

	return data, nil
}

func getCockpitControlMsg(iface interface{}) error {
	buf, err := readFrame(syscall.Stdin)
	if err == nil {
		err = json.Unmarshal(buf, iface)
	}
	return err
}

func sendCockpitControlMsg(data interface{}) error {
	response, respErr := json.Marshal(data)
	if respErr != nil {
		return respErr
	}

	_, err := syscall.Write(syscall.Stdout, []byte(fmt.Sprintf("%d\n\n", len(response)+1)))
	if err == nil {
		_, err = syscall.Write(syscall.Stdout, response)
	}

	return err
}

func sendAuthorization(login_data map[string]interface{}) error {
	data := make(map[string]interface{})
	data["command"] = "authorize"
	data["challenge"] = "x-login-data"
	data["cookie"] = "kube-auth-unused"
	data["login-data"] = login_data
	return sendCockpitControlMsg(data)
}

func sendInitProblem(err error) error {
	log.Println(err)
	errorType := "internal-error"
	if _, ok := err.(*helpers.AuthError); ok {
		errorType = "authentication-failed"
	}

	data := make(map[string]interface{})
	data["command"] = "init"
	data["problem"] = errorType
	data["message"] = fmt.Sprintf("%s", err)
	return sendCockpitControlMsg(data)
}

func challengeForAuthData() ([]byte, error) {
	t := time.Now()
	data := make(map[string]interface{})
	data["command"] = "authorize"
	data["challenge"] = "*"
	data["cookie"] = fmt.Sprintf("cookie%d%d", os.Getpid(), t.Unix())

	err := sendCockpitControlMsg(data)
	if err != nil {
		return nil, nil
	}

	r := ChallengeResponse{}
	fetchErr := getCockpitControlMsg(&r)
	if fetchErr != nil {
		return nil, fetchErr
	}

	if r.Command != "authorize" {
		return nil, errors.New(fmt.Sprintf("Got invalid command %s", r.Command))
	}

	return []byte(r.Response), nil
}

func runStub() int {
	var wstatus syscall.WaitStatus
	sysProcAttr := &syscall.SysProcAttr{
		Pdeathsig: syscall.SIGTERM,
	}

	procAttr := &syscall.ProcAttr{
		Env:   os.Environ(),
		Files: []uintptr{os.Stdin.Fd(), os.Stdout.Fd(), os.Stderr.Fd()},
		Sys:   sysProcAttr,
	}

	pid, fork_err := syscall.ForkExec("/usr/libexec/cockpit-stub", nil, procAttr)
	if fork_err != nil {
		log.Fatal("Error forking process:", fork_err)
	}

	_, wait_err := syscall.Wait4(pid, &wstatus, 0, nil)
	for wait_err == syscall.EINTR {
		_, wait_err = syscall.Wait4(pid, &wstatus, 0, nil)
	}
	if wait_err != nil {
		log.Fatal("Error waiting on bridge pid:", wait_err)
	}

	return wstatus.ExitStatus()
}

func main() {
	authData, err := challengeForAuthData()
	if err != nil {
		log.Fatal("Error reading authentication data ", err)
	}

	client := helpers.NewClient()
	response, loginErr := client.Login(string(authData))
	if loginErr != nil {
		err = sendInitProblem(loginErr)
	} else {
		err = sendAuthorization(response)
	}

	if err != nil {
		log.Fatal("Error sending auth result", err)
	}

	if err == nil && loginErr == nil {
		if os.Getenv("XDG_RUNTIME_DIR") == "" {
			os.Setenv("XDG_RUNTIME_DIR", "/tmp")
		}

		status := runStub()
		err = client.CleanUp()
		if err != nil {
			log.Fatal("Error deleting token", err)
		}

		os.Exit(status)
	}
}
