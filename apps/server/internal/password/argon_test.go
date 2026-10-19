package password

import "testing"

func TestArgonHashSaltAndVerification(t *testing.T) {
	first, second := Hash("密碼 password 123"), Hash("密碼 password 123")
	if first == second {
		t.Fatal("salt reused")
	}
	if ok, err := Verify("密碼 password 123", first); err != nil || !ok {
		t.Fatalf("valid password rejected: %v", err)
	}
	if ok, err := Verify("wrong password", first); err != nil || ok {
		t.Fatal("wrong password accepted")
	}
	for _, value := range []string{"", "$argon2id$v=19$m=999999999,t=999,p=255$abc$abc", prefix + "bad", prefix + "bad$bad"} {
		if _, err := Verify("password", value); err == nil {
			t.Fatal("malformed hash accepted")
		}
	}
}
